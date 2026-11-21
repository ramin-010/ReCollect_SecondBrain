---
name: log-work
description: Log the day's work from this chat into the user's work log in Recollect (its `log_work` tool), with the time each part took, so "what did I do on this project yesterday?" has an answer before their standup. Use when they say /log-work, "log today's work", "log the work we did", or accepts an offer to log the day.
---

# Log the day's work

The user's work log keeps what they did per project and day. In work folders nothing is captured by itself: this is how the day gets there. They ask; you write it.

1. **Get the clock.** Call `log_work` with no lines. It answers today's turns in this folder (when they wrote, its first words, when your reply ended) and the stretches worked, from the hooks' clock on their PC. For another day they name (yesterday's work, the next morning), pass `day` (YYYY-MM-DD). With no clock (claude.ai, a folder without the hooks), skip the times.
2. **Write 3–6 lines** from this chat (and today's commits in this repo if that helps: `git log --since=midnight --oneline`):
   - `kind`: `did` (built, fixed, changed, checked), `decided` (a choice and, in a few words, why), `stuck` (a problem not solved yet), `next` (what comes next).
   - `text`: one plain past-tense line they could say in a standup, under 160 characters: "Fixed the GST rounding in the invoice report".
   - `at`: the time span it took, read from the clock ("10:15–11:40"); leave it out when the clock doesn't show it.
   - Only what this chat shows was done. Merge small steps into one line. No code, file contents, secrets, keys or links with them; no names of private people.
3. **Call `log_work` with the lines.** Calling it again in the same chat replaces its lines for that day, so fix a mistake by sending the whole list again.
4. **Answer in one line** ("Logged 4 lines for erp, Mon 16 Nov."). Don't paste the lines back unless they ask.
