# syntax=docker/dockerfile:1

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

WORKDIR /src

COPY *.csproj ./

RUN --mount=type=cache,id=blockgo-nuget,target=/root/.nuget/packages \
    dotnet restore

COPY . .

RUN --mount=type=cache,id=blockgo-nuget,target=/root/.nuget/packages \
    dotnet publish \
        --configuration Release \
        --output /app/publish \
        --no-restore \
        /p:UseAppHost=false


FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final

USER root

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        libpcre2-8-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build --chown=app:app /app/publish .

RUN mkdir -p /app/logs && \
    chown -R app:app /app

ENV ASPNETCORE_URLS=http://0.0.0.0:5000
ENV DOTNET_RUNNING_IN_CONTAINER=true

EXPOSE 5000

USER app

ENTRYPOINT ["dotnet", "For_Testing_Only_Capstone.dll"]
