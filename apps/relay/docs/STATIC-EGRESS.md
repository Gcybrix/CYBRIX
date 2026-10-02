# CYBRIX Relay — Static Egress Verification (Prompt 7 §23/§24/§34)

## 1. Honest status statement

**STATIC_EGRESS_STATUS = UNKNOWN** (as of this stage).

Railway does **not** document a guaranteed static/public egress IP for standard deploys, and
**no verification has been executed here** — this stage was produced in a sandbox without a
Railway account, and Prompt 7 §24 forbids recording `STATIC_VERIFIED` from documentation
alone. Until the procedure below has been run against a REAL deployment, the result stays
`UNKNOWN`, and CYBRIX makes **no** static-egress claim.

The complete CYBRIX architecture does NOT depend on this feature (Prompt 2: the relay is
optional; Panel + Bot work without it).

## 2. Verification procedure (§24 — required steps)

Run on the deployed relay (Railway shell / `railway run` / container exec):

```bash
node apps/relay/scripts/verify-egress.mjs                # single observation
node apps/relay/scripts/verify-egress.mjs --repeat 5 --delay 30
```

The script queries multiple independent sources (api.ipify.org, ifconfig.me,
checkip.amazonaws.com) and prints one JSON observation per line
(`{"ts","egress_ip","source","attempt"}`).

| Step | Action | Observation |
|---|---|---|
| 1 | Deploy relay | run probe → record `egress_ip` |
| 2 | Restart the service (Railway Restart) | run probe again |
| 3 | Redeploy (new image/config) | run probe again |
| 4 | Scale/restart scenario (§34): stop → start | run probe again |
| 5 | Compare the observed address set | see classification |
| 6 | Record the result in the table below (with dates) | — |

### Classification (§24)

| Condition | Status |
|---|---|
| All observations across cold start + restart + redeploy + scale show the SAME address | `STATIC_VERIFIED` |
| Observations show changing addresses | `DYNAMIC` |
| Probe could not run / results inconclusive | `UNKNOWN` |
| Provider gives no stable egress at all / feature unusable | `UNSUPPORTED` |

## 3. Result record (fill after each real run)

```text
Date        Scenario     Observed egress IP     Source              Operator
----------  -----------  ---------------------  ------------------  --------
            cold start
            restart
            redeploy
            scale/start

STATIC_EGRESS_STATUS = UNKNOWN | DYNAMIC | STATIC_VERIFIED | UNSUPPORTED
```

## 4. If the result is DYNAMIC / UNSUPPORTED

Keep the feature OPTIONAL and choose an explicit architecture (Prompt 7 §23 — document costs
and limits; never advertise what is not verified):

1. **Different provider for the relay** — any VPS/dedicated provider that offers a static
   IPv4 (Hetzner, OVH, Vultr, …). The relay is a plain Docker container; it runs unchanged
   (its `Dockerfile` is provider-agnostic). This is the cleanest option.
2. **NAT/egress gateway** — put the relay (or the whole egress path) behind a gateway VM with
   a fixed IP; extra hop + cost, but keeps Railway's managed runtime.
3. **Provider-native static egress** — if Railway introduces an official static-egress
   feature, re-run §2 and only then update the status.

## 5. Scope & permitted use

Static egress exists in CYBRIX exclusively for legitimate operational needs: IP
allowlisting, enterprise network access, controlled outbound routing, testing,
infrastructure integration. Nothing in CYBRIX is designed to bypass filtering, access
controls or terms of service of any network or provider.
