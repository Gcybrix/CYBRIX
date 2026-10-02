#!/usr/bin/env python3
"""Railway project bootstrap via GraphQL — prints only IDs (never the token)."""
import json, os, urllib.request

TOKEN = os.environ["RAILWAY_API_TOKEN"]
API = "https://backboard.railway.app/graphql/v2"

def gql(query, variables=None):
    req = urllib.request.Request(API, data=json.dumps({"query": query, "variables": variables or {}}).encode(),
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "cybrix-deploy/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

# 1) create project (v2 creates a production environment too)
res = gql('mutation($name:String!){ projectCreate(name:$name){ id } }', {"name": "CYBRIX Relay"})
if "errors" in res:
    print("projectCreateV2 errors:", res["errors"])
    res = gql('{ projects { edges { node { id name } } } }')
    proj = [n["node"] for n in res["data"]["projects"]["edges"] if n["node"]["name"] == "CYBRIX Relay"]
    pid = proj[0]["id"]
else:
    pid = res["data"]["projectCreateV2"]["id"]
print("project_id:", pid)

# 2) environments
res = gql('query($id:String!){ project(id:$id){ environments { edges { node { id name } } } } }', {"id": pid})
envs = res["data"]["project"]["environments"]["edges"]
env_id = envs[0]["node"]["id"]
print("environment:", envs[0]["node"]["name"], env_id)

# 3) service
res = gql('mutation($projectId:String!,$name:String!){ serviceCreate(projectId:$projectId, name:$name){ id } }',
          {"projectId": pid, "name": "cybrix-relay"})
if "errors" in res:
    print("serviceCreate errors:", res["errors"])
    res = gql('query($id:String!){ project(id:$id){ services { edges { node { id name } } } } }', {"id": pid})
    svc = [n["node"] for n in res["data"]["project"]["services"]["edges"] if n["node"]["name"] == "cybrix-relay"]
    sid = svc[0]["id"]
else:
    sid = res["data"]["serviceCreate"]["id"]
print("service_id:", sid)

# 4) project token (RAILWAY_TOKEN) — do not print value
res = gql('mutation($projectId:String!,$environments:[String!]){ projectTokenCreate(projectId:$projectId, environments:$environments){ token } }',
          {"projectId": pid, "environments": [env_id]})
ok = "token" in (res.get("data") or {}).get("projectTokenCreate", {})
with open(os.path.join(REPO, ".secrets/railway-project-token.env"), "w") as f:
    f.write(f"RAILWAY_TOKEN={res['data']['projectTokenCreate']['token']}\n")
os.chmod(os.path.join(REPO, ".secrets/railway-project-token.env"), 0o600)
print("project_token created:", ok)
print("ids saved to .secrets/railway-ids.env")
with open(os.path.join(REPO, ".secrets/railway-ids.env"), "w") as f:
    f.write(f"RAILWAY_PROJECT_ID={pid}\nRAILWAY_ENVIRONMENT_ID={env_id}\nRAILWAY_SERVICE_ID={sid}\n")
