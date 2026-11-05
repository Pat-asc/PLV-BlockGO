#!/usr/bin/env python3

from pathlib import Path
from datetime import datetime
import argparse
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]

INGRESS = ROOT / "network/k8s/15-main-ingress.yaml"
CONTROLLERS = ROOT / "client-app/Controllers"
TOPOLOGY = ROOT / "client-app/Microservices/DotnetServiceTopology.cs"

CLIENT_SERVICE = "client-app-service"
CLIENT_PORT = 5000

MIDDLEWARE_OWNED_ROUTES = {
    "/api/login",
    "/api/register",
    "/api/bootstrap",
    "/api/fabric",
}


def normalize_route(route: str, controller_name: str | None = None):
    route = route.strip().strip('"').strip("'")

    if not route:
        return None

    route = route.replace("\\/", "/")

    if controller_name:
        route = re.sub(
            r"\[controller\]",
            controller_name,
            route,
            flags=re.IGNORECASE,
        )

    # Only public API routes matter here.
    if route.startswith("api/"):
        route = "/" + route
    elif not route.startswith("/api/") and route != "/api":
        return None

    route = route.split("?")[0]

    # Ingress Prefix paths cannot contain ASP.NET placeholders.
    # /api/foo/{id}/bar -> /api/foo
    parts = route.split("/")
    clean = []

    for part in parts:
        if "{" in part or "[" in part:
            break
        clean.append(part)

    route = "/".join(clean)

    route = re.sub(r"/+", "/", route)

    if len(route) > 1:
        route = route.rstrip("/")

    if route == "/api":
        return None

    return route


def extract_controller_routes(path: Path):
    text = path.read_text(encoding="utf-8", errors="ignore")

    routes = set()

    class_match = re.search(
        r"class\s+([A-Za-z0-9_]+)Controller\b",
        text,
    )

    controller_name = class_match.group(1) if class_match else path.stem
    if controller_name.endswith("Controller"):
        controller_name = controller_name[:-10]

    # Controller and method route attributes.
    patterns = [
        r'\[Route\(\s*"([^"]+)"\s*\)\]',
        r'\[HttpGet\(\s*"([^"]+)"\s*\)\]',
        r'\[HttpPost\(\s*"([^"]+)"\s*\)\]',
        r'\[HttpPut\(\s*"([^"]+)"\s*\)\]',
        r'\[HttpPatch\(\s*"([^"]+)"\s*\)\]',
        r'\[HttpDelete\(\s*"([^"]+)"\s*\)\]',
    ]

    controller_prefixes = []

    for match in re.finditer(patterns[0], text, flags=re.IGNORECASE):
        r = normalize_route(match.group(1), controller_name)

        if r:
            controller_prefixes.append(r)
            routes.add(r)

    # Absolute API paths declared on action methods.
    for pattern in patterns[1:]:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            raw = match.group(1).strip()

            if raw.startswith("/api/") or raw.startswith("api/"):
                r = normalize_route(raw, controller_name)
                if r:
                    routes.add(r)

    # If a controller has api/[controller], its base route is enough.
    return routes


def extract_topology_routes():
    if not TOPOLOGY.exists():
        return set()

    text = TOPOLOGY.read_text(encoding="utf-8", errors="ignore")

    routes = set()

    # DotnetServiceTopology contains route strings such as:
    # "/api/password-reset-requests"
    # "/api/password-reset-requests/{**catch-all}"
    for match in re.finditer(r'"(/api/[^"]+)"', text):
        r = normalize_route(match.group(1))

        if r:
            routes.add(r)

    return routes


def discover_dotnet_routes():
    routes = set()

    if not CONTROLLERS.exists():
        raise RuntimeError(f"Controllers directory not found: {CONTROLLERS}")

    for path in CONTROLLERS.rglob("*.cs"):
        routes.update(extract_controller_routes(path))

    routes.update(extract_topology_routes())

    routes = {
        route
        for route in routes
        if route not in MIDDLEWARE_OWNED_ROUTES
    }

    return routes


def parse_ingress_routes(text: str):
    """
    Return [(path, service)] from the simple Kubernetes ingress format
    used by this repository.
    """
    lines = text.splitlines()

    entries = []

    current_path = None
    current_service = None

    for i, line in enumerate(lines):
        m = re.match(r"^\s*-\s+path:\s*(\S+)\s*$", line)

        if m:
            if current_path is not None:
                entries.append((current_path, current_service))

            current_path = m.group(1).strip("\"'")
            current_service = None
            continue

        if current_path is not None:
            m = re.match(r"^\s*name:\s*(\S+)\s*$", line)

            if m and current_service is None:
                current_service = m.group(1).strip("\"'")

    if current_path is not None:
        entries.append((current_path, current_service))

    return entries


def is_covered(route: str, existing_client_paths):
    """
    A Prefix route /api/Auth already covers /api/Auth/user-profile.
    """
    for existing in existing_client_paths:
        if route == existing:
            return True

        if route.startswith(existing.rstrip("/") + "/"):
            return True

    return False


def remove_redundant(routes):
    """
    Keep the shortest useful prefixes.

    Example:
      /api/Auth
      /api/Auth/user-profile

    becomes:
      /api/Auth
    """
    result = []

    for route in sorted(routes, key=lambda x: (len(x), x.lower())):
        covered = False

        for parent in result:
            if route == parent or route.startswith(parent.rstrip("/") + "/"):
                covered = True
                break

        if not covered:
            result.append(route)

    return sorted(result, key=str.lower)


def build_ingress_block(route):
    return (
        f"      - path: {route}\n"
        f"        pathType: Prefix\n"
        f"        backend:\n"
        f"          service:\n"
        f"            name: {CLIENT_SERVICE}\n"
        f"            port:\n"
        f"              number: {CLIENT_PORT}\n\n"
    )


def find_generic_api_fallback(text):
    """
    Find:
      - path: /api
        ...
        name: middleware-api
    """
    pattern = re.compile(
        r"(?m)^      - path: /api\s*$"
    )

    for match in pattern.finditer(text):
        tail = text[match.start():match.start() + 400]

        if re.search(r"name:\s*middleware-api\b", tail):
            return match.start()

    return None


def main():
    parser = argparse.ArgumentParser(
        description="Synchronize ASP.NET public API prefixes into GKE Ingress."
    )

    parser.add_argument(
        "--write",
        action="store_true",
        help="Modify 15-main-ingress.yaml. Without this flag only report.",
    )

    args = parser.parse_args()

    if not INGRESS.exists():
        print(f"ERROR: {INGRESS} does not exist.", file=sys.stderr)
        return 2

    ingress_text = INGRESS.read_text(
        encoding="utf-8",
        errors="ignore",
    )

    discovered = remove_redundant(discover_dotnet_routes())

    ingress_entries = parse_ingress_routes(ingress_text)

    client_paths = {
        path
        for path, service in ingress_entries
        if service == CLIENT_SERVICE
    }

    missing = [
        route
        for route in discovered
        if not is_covered(route, client_paths)
    ]

    print("=" * 70)
    print("DOTNET INGRESS AUDIT")
    print("=" * 70)

    print(f"Discovered .NET route prefixes : {len(discovered)}")
    print(f"Ingress client-app paths       : {len(client_paths)}")
    print(f"Missing Ingress paths          : {len(missing)}")

    print("\n.NET API PREFIXES")
    for route in discovered:
        status = "OK" if is_covered(route, client_paths) else "MISSING"
        print(f"{status:8} {route}")

    if not missing:
        print("\nNo missing .NET Ingress routes were found.")
        return 0

    print("\nMISSING ROUTES")
    for route in missing:
        print(f"  {route}")

    if not args.write:
        print(
            "\nNo files changed. "
            "Run again with --write to update the Ingress."
        )
        return 1

    insert_at = find_generic_api_fallback(ingress_text)

    if insert_at is None:
        print(
            "\nERROR: Could not find the generic "
            "/api -> middleware-api fallback.",
            file=sys.stderr,
        )
        return 2

    backup = INGRESS.with_suffix(
        INGRESS.suffix
        + ".backup-"
        + datetime.now().strftime("%Y%m%d-%H%M%S")
    )

    shutil.copy2(INGRESS, backup)

    block = (
        "      # Auto-synchronized ASP.NET API routes.\n"
        + "".join(build_ingress_block(route) for route in missing)
    )

    new_text = (
        ingress_text[:insert_at]
        + block
        + ingress_text[insert_at:]
    )

    INGRESS.write_text(new_text, encoding="utf-8")

    print(f"\nUpdated : {INGRESS.relative_to(ROOT)}")
    print(f"Backup  : {backup.relative_to(ROOT)}")
    print(f"Added   : {len(missing)} routes")

    print("\nRun next:")
    print(
        "kubectl apply --dry-run=client "
        "-f network/k8s/15-main-ingress.yaml"
    )
    print(
        "kubectl diff "
        "-f network/k8s/15-main-ingress.yaml"
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
