# Project Notes — Akashic Tarot

Project-specific guidance that supplements the user's global CLAUDE.md.

## UTF-8 on Windows — Two rules that bit us, written down so they don't again

This codebase routinely shuttles Chinese strings between Python, SQLite, Ollama
(over HTTP), curl, PowerShell, and the Windows console. The default encoding
on each surface is *different*. These two rules cover ~all of the "Chinese
turned into garbage" incidents we've had.

### Rule 1 — Outgoing HTTP bodies: encode UTF-8 bytes explicitly

**Symptom:** the server receives `?` characters where Chinese should be, or
the LLM responds in English / about unrelated topics ("dialects", "dates")
because the prompt arrived mangled.

**Cause:** the default JSON request handling in Windows PowerShell
(`Invoke-RestMethod -Body $obj`) and in some Python builds drops non-ASCII to
`?` before the body ever leaves the client.

**Fix — Python (already applied in `interpret_service._utf8_post` and
`interpret_agent._utf8_post_json`):**

```python
body_bytes = json.dumps(body_dict, ensure_ascii=False).encode("utf-8")
req = urllib.request.Request(url, data=body_bytes, method="POST")
req.add_header("Content-Type", "application/json; charset=utf-8")
```

Encode the body yourself as UTF-8 bytes. Do not let the library serialize it
for you.

**Fix — PowerShell:**

```powershell
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
Invoke-RestMethod -Uri $url -Method POST -ContentType 'application/json; charset=utf-8' -Body $bytes
```

**Fix — curl on Windows / Git Bash:** write the JSON body to a file (the file
itself must be UTF-8, no BOM) and send `--data-binary @file.json`. Do **not**
pass `-d '{"question":"中文"}'` — the shell may mangle it.

### Rule 2 — Inspecting Chinese output: don't pipe through `python -m json.tool`

**Symptom:** API output looks like mojibake (`鎴戝簲璇ヨ烦`, or `鎴戝...`
with stray surrogates like `\udc9f`), but the LLM clearly understood the
input (classifier returned correct topic, generated text was on-topic).

**Cause:** `python -m json.tool` writes to stdout using the *console encoding*,
which on Windows defaults to `cp936` (GBK). The UTF-8 bytes that came in get
decoded as GBK and the result is either gibberish CJK chars or surrogate
escapes when bytes don't form valid GBK pairs.

**The data is not corrupted** — only the rendered display is. Verify this
before "fixing" anything:

```python
# Read raw bytes from the wire / SQLite column, don't trust prettified output.
import json, urllib.request
raw = urllib.request.urlopen("http://localhost:8080/api/interpret/6/agent-trace").read()
print(raw[:400])                                            # raw UTF-8 bytes
print(json.dumps(json.loads(raw), ensure_ascii=False))      # readable
```

For SQLite:

```python
row = conn.execute("SELECT input_summary FROM agent_steps WHERE id=?", (n,)).fetchone()
print(row[0].encode("utf-8"))   # truth: bytes
print(row[0])                   # may render as ?? in the console
```

**Cheap fix when you do want pretty JSON in the terminal:** write to a file
first, then open it in an editor that knows UTF-8:

```bash
curl -s http://localhost:8080/api/... > out.json
# inspect out.json in VS Code / any UTF-8-aware viewer
```

Or set the Python stdout encoding for the duration of the call:

```bash
PYTHONIOENCODING=utf-8 curl -s http://... | python -m json.tool
```

### Debugging checklist when Chinese looks wrong

Before assuming the data is corrupted, prove it with bytes:

1. Read the source bytes directly (`open(..., 'rb')` for files, `.encode('utf-8')`
   for SQLite columns, raw `read()` for HTTP responses).
2. Check that they decode cleanly as UTF-8.
3. If yes → it's a display issue. Stop changing code.
4. If no → trace upstream: where did the byte sequence get re-encoded?

Surrogate codepoints (`\udc80`–`\udcff`) in any string are a tell that bytes
were decoded as Latin-1 / surrogateescape somewhere. Find that decode call.
