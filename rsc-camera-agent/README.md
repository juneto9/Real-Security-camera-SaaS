# RSC Camera Agent

Headless webcam publisher for Real Security Camera.  
Captures your device's webcam and streams it to the LiveKit cloud relay — no browser, no window, no user interaction after install.

## How It Works

```
[Your PC Webcam] → [RSC Camera Agent] → [LiveKit VPS] → [Dashboard Viewer]
```

The agent runs as a **Windows service** or **Linux daemon**. It:
1. Reads `agent_config.json` for your camera ID and server URLs
2. Fetches a LiveKit JWT token from your VPS token server
3. Uses `livekit-cli` to capture and publish the webcam feed
4. Auto-reconnects on any disconnect
5. Starts automatically on boot

## Files in This Package

| File | Purpose |
|---|---|
| `rsc-camera-agent.exe` | The agent binary |
| `livekit-cli.exe` | LiveKit CLI (bundled, used for WebRTC publishing) |
| `agent_config.json` | Your device configuration — **edit this** |
| `install.bat` | One-click Windows installer (run as Administrator) |
| `uninstall.bat` | Removes the service and files |

## Quick Install (Windows)

1. **Edit `agent_config.json`** — set your `camera_id` (get it from Dashboard → Camera Settings)
2. **Right-click `install.bat`** → **Run as Administrator**
3. Done. The service starts immediately and auto-starts on every boot.

## Quick Install (Linux)

```bash
# Edit config
nano agent_config.json

# Install
sudo cp rsc-camera-agent livekit-cli /usr/local/bin/
sudo mkdir -p /etc/rsc
sudo cp agent_config.json /etc/rsc/

# Create systemd service
sudo tee /etc/systemd/system/rsc-camera-agent.service << EOF
[Unit]
Description=RSC Camera Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/rsc-camera-agent -config /etc/rsc/agent_config.json
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now rsc-camera-agent
```

## Configuration

`agent_config.json`:
```json
{
  "camera_id": "YOUR_CAMERA_ID_HERE",
  "token_url": "https://livekit.realsecuritycamera.com/livekit-token",
  "livekit_url": "wss://livekit.realsecuritycamera.com",
  "device_name": "My Office PC",
  "identity": ""
}
```

| Field | Required | Description |
|---|---|---|
| `camera_id` | **Yes** | Your camera's ID from the dashboard |
| `token_url` | No | Defaults to your VPS token server |
| `livekit_url` | No | Defaults to your LiveKit WSS endpoint |
| `device_name` | No | Friendly name (defaults to hostname) |
| `identity` | No | Publisher identity (defaults to `agent-HOSTNAME`) |

## Uninstall

**Windows:** Run `uninstall.bat` as Administrator  
**Linux:** `sudo systemctl disable --now rsc-camera-agent && sudo rm /usr/local/bin/rsc-camera-agent`

## Building from Source

```bash
cd rsc-camera-agent
go build -ldflags="-s -w" -o rsc-camera-agent.exe .
```

Or trigger the GitHub Actions workflow which builds Windows/Linux/macOS binaries automatically.
