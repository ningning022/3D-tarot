# Akashic Tarot

Akashic Tarot is a local, gesture-controlled 3D tarot reading app. It uses Three.js for the card scene, MediaPipe Hands for webcam gestures, and a zero-dependency Python + SQLite backend for saved readings.

The app is designed for local use first: no account system, no cloud service, and no build step.

## Features

- 78-card tarot deck with an animated 3D carousel.
- Webcam gesture controls for selecting, inspecting, confirming, and continuing readings.
- Mouse fallback when the camera is unavailable.
- Local SQLite storage for reading history.
- Built-in spread templates for 3-card, 5-card, Celtic Cross, and free spreads.
- Daily Draw creates one local card record per day without interpretation text.
- Read-only database viewer at `admin.html` with visual spread replay.
- Safe "clear database" action guarded by a `CLEAR` confirmation prompt.
- Responsive multi-card spread layout for large readings.

## Quick Start

Requirements:

- Python 3.10 or newer
- A modern browser with WebGL support
- Internet access for the CDN-hosted Three.js and MediaPipe scripts
- Node.js only if you want to run the JavaScript checks/tests

Start the local static server and SQLite API:

```bash
python server.py
```

Then open:

- Main app: `http://localhost:8080/Three.html`
- Database viewer: `http://localhost:8080/admin.html`
- Health check: `http://localhost:8080/api/health`

Do not open `Three.html` by double-clicking it if you want persistent history. The page can still run as a static file, but SQLite saving requires `python server.py`.

## Gestures

| Gesture | State | Action |
| --- | --- | --- |
| OPEN | Idle | Start the selected spread template. Previously selected cards are used first; fixed templates are filled or trimmed to their slot count. |
| POINT | Idle | Pause the carousel and highlight the pointed card. |
| PINCH | Idle | Pick up and inspect the pointed carousel card. |
| TWO_FINGER | Idle | Swipe left or right to change carousel speed/direction. |
| PINCH | Spread | Pick up and inspect a spread card. |
| FIST | Holding a spread card | Confirm the card and save it into the current reading. |
| OPEN | Spread | Return the held card to its slot. |
| OPEN | Prompt | Continue with another spread. |
| FIST | Prompt | End the reading and return to idle. |

## Database

The backend automatically creates a local SQLite database at:

```text
data/tarot.sqlite3
```

This file contains local reading history and is ignored by git. Do not commit real `data/*.sqlite3` files to a public repository.

The database stores:

- `readings`: one row per completed spread or daily draw, including kind, template key/name, date, and created time.
- `reading_cards`: the cards in each record, including slot, slot label, card id, Chinese and English names, image file name, and upright/reversed state.

The admin page can view saved records, replay each saved spread visually, and clear all readings. Clearing the database is irreversible for the local SQLite file.

## API

All API routes are served by `server.py`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Returns backend/database readiness. |
| `POST` | `/api/readings` | Saves a completed reading. |
| `GET` | `/api/readings?limit=20` | Lists recent readings, newest first. |
| `GET` | `/api/readings/{id}` | Loads one reading and its cards. |
| `DELETE` | `/api/readings` | Clears all local reading records and resets ids. |
| `GET` | `/api/daily-draw?date=YYYY-MM-DD` | Loads the saved Daily Draw for a local date. |
| `POST` | `/api/daily-draw` | Creates or returns the Daily Draw for a local date. |

Example save request:

```json
{
  "kind": "spread",
  "templateKey": "three_timeline",
  "templateName": "三张牌 / Past Present Future",
  "readingDate": "2026-04-25",
  "spreadNumber": 1,
  "cards": [
    {
      "slot": 1,
      "slotLabel": "过去 / Past",
      "cardId": 0,
      "zh": "愚人",
      "en": "The Fool",
      "imageFile": "RWS_Tarot_00_Fool.jpg",
      "isReversed": false
    }
  ]
}
```

## Project Structure

```text
taluo/
├── Three.html          # Main tarot app
├── admin.html          # Local reading history viewer
├── server.py           # Static server + SQLite API
├── css/
│   └── style.css
├── data/
│   └── .gitkeep        # Runtime SQLite files are created here and ignored
├── image2/
│   ├── 00.jpg          # Card back
│   └── *.jpg           # Tarot card images
├── js/
│   ├── api.js          # API wrapper with offline fallback
│   ├── admin.js        # Admin page UI
│   ├── carousel.js     # Idle carousel
│   ├── daily_draw.js   # Daily Draw creation/rendering
│   ├── deck.js         # Card definitions
│   ├── gesture.js      # Gesture classification and stabilization
│   ├── history.js      # Reading capture and history rendering
│   ├── main.js         # Three.js setup and animation loop
│   ├── mediapipe.js    # MediaPipe camera integration
│   ├── reading_replay.js # Admin spread replay helper
│   ├── spread.js       # Spread state machine and card interactions
│   ├── spread_flow.js  # Small testable spread-flow helpers
│   ├── spread_layout.js # Responsive spread layout helper
│   ├── spread_templates.js # Spread template definitions
│   ├── state.js        # Shared runtime state
│   ├── ui.js           # Card label UI helpers
│   └── utils.js        # Texture and cleanup helpers
└── tests/
    ├── test_gesture.js
    ├── test_daily_draw.js
    ├── test_reading_orientation.js
    ├── test_reading_replay.js
    ├── test_server.py
    ├── test_spread_templates.js
    └── test_spread_layout.js
```

## Tests

Run JavaScript behavior checks:

```bash
node tests/test_gesture.js
node tests/test_daily_draw.js
node tests/test_spread_layout.js
node tests/test_spread_templates.js
node tests/test_reading_orientation.js
node tests/test_reading_replay.js
```

Check JavaScript syntax:

```powershell
Get-ChildItem js -Filter *.js | ForEach-Object { node --check $_.FullName }
```

Run backend tests:

```bash
python -m unittest tests.test_server -v
```

## Open Source Notes

- The code is licensed under the MIT License.
- The card images in `image2/` are included for the local demo. Their rights may differ from the project code license. Check the applicable artwork rights before redistributing the images in another project.
- Camera gestures require browser camera permission.
- Three.js and MediaPipe are loaded from public CDNs in `Three.html`, so the default setup needs network access when the page starts.

## License

MIT. See [LICENSE](LICENSE).
