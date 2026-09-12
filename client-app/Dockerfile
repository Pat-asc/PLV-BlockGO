FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

WORKDIR /src

COPY *.csproj ./

RUN --mount=type=cache,id=blockgo-nuget,target=/root/.nuget/packages \
    dotnet restore For_Testing_Only_Capstone.csproj --disable-parallel

COPY . .

RUN --mount=type=cache,id=blockgo-nuget,target=/root/.nuget/packages \
    dotnet publish For_Testing_Only_Capstone.csproj \
    -c Release \
    -o /app/publish \
    --no-restore


FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final

USER root

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        --only-upgrade libpcre2-8-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/publish .

RUN dpkg-query -W -f='${Package} ${Version}\n' libpcre2-8-0

EXPOSE 5000 5101 5102 5103 5104 5105

ENV ASPNETCORE_URLS=http://+:5000

ENTRYPOINT ["dotnet", "For_Testing_Only_Capstone.dll"]