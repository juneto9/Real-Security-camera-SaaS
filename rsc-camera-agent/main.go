package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

const (
	AppName    = "RSCCameraAgent"
	AppVersion = "2.2.0"
	RegServer  = "https://livekit.realsecuritycamera.com"
)

type AgentConfig struct {
	CameraID   string `json:"camera_id"`
	TokenURL   string `json:"token_url"`
	LiveKitURL string `json:"livekit_url"`
	DeviceName string `json:"device_name"`
	Identity   string `json:"identity"`
}

func main() {
	doInstall := flag.Bool("install", false, "Install to auto-start on login")
	doRemove := flag.Bool("uninstall", false, "Remove from auto-start")
	configPath := flag.String("config", "", "Path to agent_config.json")
	flag.Parse()
	setupLogging()
	if *doInstall { install(); return }
	if *doRemove { uninstall(); return }
	hideWindow()
	log.Printf("[RSC] Camera Agent v%s starting", AppVersion)
	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Printf("[RSC] Config error: %v", err)
		showError(fmt.Sprintf("Config error: %v\nRun the installer first.", err))
		os.Exit(1)
	}
	if needsReg(cfg.CameraID) {
		log.Println("[RSC] No camera ID - starting registration")
		newCfg, err := doRegistration()
		if err != nil {
			showError(fmt.Sprintf("Registration failed: %v\nGet a device code from your RSC dashboard.", err))
			os.Exit(1)
		}
		cfgFile := filepath.Join(getExeDir(), "agent_config.json")
		if *configPath != "" { cfgFile = *configPath }
		saveConfig(cfgFile, newCfg)
		cfg = newCfg
		showInfo(fmt.Sprintf("Camera registered!\n\nDevice: %s\nCamera ID: %s\n\nThe agent will now stream in the background.", cfg.DeviceName, cfg.CameraID))
	}
	log.Printf("[RSC] Camera: %s Token: %s LK: %s", cfg.CameraID, cfg.TokenURL, cfg.LiveKitURL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() { <-sigCh; cancel() }()
	for {
		select {
		case <-ctx.Done(): return
		default:
		}
		err := publishSession(ctx, cfg)
		if err != nil && ctx.Err() == nil {
			log.Printf("[RSC] Session ended: %v - reconnecting in 5s", err)
		}
		select {
		case <-ctx.Done(): return
		case <-time.After(5 * time.Second):
		}
	}
}

func needsReg(id string) bool {
	return id == "" || id == "PASTE_YOUR_CAMERA_ID_HERE" || id == "auto"
}

func doRegistration() (*AgentConfig, error) {
	code := promptForCode("Enter the 6-digit device code from your RSC dashboard:")
	if code == "" { return nil, fmt.Errorf("no code entered") }
	code = strings.TrimSpace(code)
	hostname, _ := os.Hostname()
	payload, _ := json.Marshal(map[string]string{"code": code, "hostname": hostname})
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(RegServer+"/claim-code", "application/json", bytes.NewReader(payload))
	if err != nil { return nil, fmt.Errorf("cannot reach server: %w", err) }
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == 404 { return nil, fmt.Errorf("invalid code") }
	if resp.StatusCode == 409 { return nil, fmt.Errorf("code already used") }
	if resp.StatusCode == 410 { return nil, fmt.Errorf("code expired") }
	if resp.StatusCode != 200 { return nil, fmt.Errorf("server error %d: %s", resp.StatusCode, string(body)) }
	var cfg AgentConfig
	json.Unmarshal(body, &cfg)
	return &cfg, nil
}

func saveConfig(path string, cfg *AgentConfig) error {
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(path, data, 0644)
}

func publishSession(ctx context.Context, cfg *AgentConfig) error {
	token, err := fetchToken(cfg)
	if err != nil { return fmt.Errorf("token: %w", err) }
	log.Println("[RSC] Token acquired, publishing...")
	cliPath := findCLI()
	if cliPath == "" { return fmt.Errorf("livekit-cli not found") }
	args := []string{"room", "join", "--url", cfg.LiveKitURL, "--token", token, "--publish", "av"}
	cmd := exec.CommandContext(ctx, cliPath, args...)
	cmd.Stdout = log.Writer()
	cmd.Stderr = log.Writer()
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil { return nil }
		return fmt.Errorf("cli exited: %w", err)
	}
	return nil
}

func fetchToken(cfg *AgentConfig) (string, error) {
	payload, _ := json.Marshal(map[string]interface{}{"room": cfg.CameraID, "identity": cfg.Identity, "canPublish": true, "canSubscribe": false})
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(cfg.TokenURL, "application/json", bytes.NewReader(payload))
	if err != nil { return "", err }
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 { return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body)) }
	var r struct{ Token, Error string }
	json.Unmarshal(body, &r)
	if r.Error != "" { return "", fmt.Errorf("server: %s", r.Error) }
	return r.Token, nil
}

func findCLI() string {
	d := getExeDir()
	for _, n := range []string{"lk", "livekit-cli"} {
		ext := ""; if runtime.GOOS == "windows" { ext = ".exe" }
		p := filepath.Join(d, n+ext)
		if _, err := os.Stat(p); err == nil { return p }
	}
	for _, n := range []string{"lk", "livekit-cli"} {
		if p, err := exec.LookPath(n); err == nil { return p }
	}
	return ""
}

func loadConfig(custom string) (*AgentConfig, error) {
	path := custom
	if path == "" { path = filepath.Join(getExeDir(), "agent_config.json") }
	data, err := os.ReadFile(path)
	if err != nil { return nil, err }
	var cfg AgentConfig
	json.Unmarshal(data, &cfg)
	if cfg.TokenURL == "" { cfg.TokenURL = "https://livekit.realsecuritycamera.com/livekit-token" }
	if cfg.LiveKitURL == "" { cfg.LiveKitURL = "wss://livekit.realsecuritycamera.com" }
	if cfg.Identity == "" { h, _ := os.Hostname(); cfg.Identity = "agent-" + strings.ToLower(h) }
	if cfg.DeviceName == "" { cfg.DeviceName, _ = os.Hostname() }
	return &cfg, nil
}

func install() {
	exePath, _ := os.Executable()
	exePath, _ = filepath.Abs(exePath)
	exeDir := filepath.Dir(exePath)
	if runtime.GOOS == "windows" {
		startup := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
		bat := fmt.Sprintf("@echo off\r\ncd /d \"%s\"\r\nstart /min \"\" \"%s\"\r\n", exeDir, exePath)
		os.WriteFile(filepath.Join(startup, "RSCCameraAgent.bat"), []byte(bat), 0644)
		fmt.Println("RSC Camera Agent installed to startup.")
	} else { fmt.Println("Linux: use systemd") }
}

func uninstall() {
	if runtime.GOOS == "windows" {
		startup := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
		os.Remove(filepath.Join(startup, "RSCCameraAgent.bat"))
		exec.Command("taskkill", "/F", "/IM", "rsc-camera-agent.exe").Run()
		fmt.Println("RSC Camera Agent removed.")
	}
}

func getExeDir() string { p, _ := os.Executable(); return filepath.Dir(p) }

func setupLogging() {
	f, err := os.OpenFile(filepath.Join(getExeDir(), "rsc-agent.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err == nil { log.SetOutput(io.MultiWriter(os.Stdout, f)) }
	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)
}
