# CYBRIX Central Bot Guide (@like_cybrixbot)

## Public commands
| Command | Purpose |
|---|---|
| `/start` | Register, mandatory-channel gate, main menu |
| `/panel` | 5-minute one-time web panel login code |
| `/wallet` | Balance + last 10 transactions |
| `/redeem CODE` | Redeem a gift code |
| `/mychannels` | Your registered channels |
| `/create` | Challenge wizard (needs a registered channel) |
| `/mystats` | Personal stats |
| `/support` | Open a support ticket (send text after the command) |
| `/lang` | Persian/English |
| `/cancel` | Cancel the active wizard |

## Challenge types (v1)
1. **Random lottery** — winners ranked by ascending `hash(salt:tid)`; commit hash published at creation, salt + snapshot hash revealed at draw for independent verification.
2. **Vote/Like** — one vote per user, changeable, public counts.
3. **Referral contest** — personal deep link; only valid invites counted (unique Telegram ID + mandatory joins).
4. **Quiz** — questions entered in the wizard as `question | opt1 | opt2 | #correctIdx`.

Wizard flow: type → title → description → destination channel → end time (Tehran) → winners → prizes → preview + cost → confirm & publish.

Costs (credits): random=1, vote=2, referral=2, quiz=3. New users get 10 free credits.

## Notes
- Before publishing, the bot verifies it can post to the channel; if not, nothing is charged and a guide is shown.
- Challenges close automatically (5-minute sweep) with a 1-hour reminder.
- The registering user must be an admin of the channel and the bot must be an admin with Post Messages permission.

## Owner commands
`/stats` platform stats · `/broadcast` announce · `/grant <tid> <amount>` credit · `/gencode <amount> <uses>` gift code · `/tickets` open tickets · `/reply <id> <text>` answer
