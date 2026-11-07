import unittest

from security.credential_rotation_policy import classify, load_exceptions

EXPECTED_EXCEPTIONS = {
    "network/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer.capstone.com/tls/server.key",
    "network/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer2.capstone.com/tls/server.key",
    "network/crypto-config-final-v2/ordererOrganizations/capstone.com/orderers/orderer3.capstone.com/tls/server.key",
    "network/crypto-config-final-v2/peerOrganizations/department.capstone.com/peers/peer0.department.capstone.com/tls/server.key",
    "network/crypto-config-final-v2/peerOrganizations/department.capstone.com/peers/peer1.department.capstone.com/tls/server.key",
    "network/crypto-config-final-v2/peerOrganizations/faculty.capstone.com/peers/peer0.faculty.capstone.com/tls/server.key",
    "network/crypto-config-final-v2/peerOrganizations/faculty.capstone.com/peers/peer1.faculty.capstone.com/tls/server.key",
    "network/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer0.registrar.capstone.com/tls/server.key",
    "network/crypto-config-final-v2/peerOrganizations/registrar.capstone.com/peers/peer1.registrar.capstone.com/tls/server.key",
    "network/crypto-orderers-new/ordererOrganizations/capstone.com/ca/priv_sk",
    "network/crypto-orderers-new/ordererOrganizations/capstone.com/tlsca/priv_sk",
    "network/orderer-org-before-k8s-san-20260914-224435/ca/priv_sk",
    "network/orderer-org-before-k8s-san-20260914-224435/tlsca/priv_sk",
}


class CredentialRotationPolicyTests(unittest.TestCase):
    def test_manifest_contains_only_the_thirteen_known_paths(self):
        exceptions = load_exceptions()
        self.assertEqual(EXPECTED_EXCEPTIONS, set(exceptions))
        for path in exceptions:
            self.assertEqual("temporary-exception", classify(path, exceptions))

    def test_unknown_private_key_paths_remain_blocking(self):
        exceptions = load_exceptions()
        for path in (
            "network/new-orderer/tls/server.key",
            "network/crypto-config/new-organization/ca/priv_sk",
            "network/new-client/client.key",
        ):
            self.assertEqual("forbidden", classify(path, exceptions))

    def test_normal_source_and_example_paths_pass(self):
        exceptions = load_exceptions()
        for path in (
            "client-app/Controllers/SystemMonitoringController.cs",
            "network/.env.example",
            "frontend/src/App.js",
        ):
            self.assertEqual("normal", classify(path, exceptions))


if __name__ == "__main__":
    unittest.main()
