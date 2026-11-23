# agentgateway-codemode probe notes

Code mode is only in Solo Enterprise for agentgateway, which needs a license key, so no probes ran.
Rerun the two checks:

```sh
docker run --rm --network none us-docker.pkg.dev/solo-public/enterprise-agentgateway/agentgateway-enterprise:2026.11.1 --config '{"binds":[]}'   # license refused startup
docker create --name agentgateway-codemode-extract us-docker.pkg.dev/solo-public/enterprise-agentgateway/agentgateway-enterprise:2026.11.1 && docker cp agentgateway-codemode-extract:/app/agentgateway /tmp/ag && docker rm agentgateway-codemode-extract && strings -n 6 /tmp/ag | grep -E 'rquickjs|ent_code_mode'
```

`out/oss-search.txt` shows the OSS repo has no code mode. `tools/write-results.py` writes the results JSON.
