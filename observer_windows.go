//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"syscall"
	"time"
	"unsafe"
)

// hiddenCmdPlatform hides child process console windows (arp, netsh, ffmpeg probe).
// Built with -H windowsgui so the main process itself never has a console window.
func hiddenCmdPlatform(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}

// setConsoleTitle is a no-op on Windows GUI subsystem builds.
func setConsoleTitle(_ string) {}

// showInstallNotification shows a Windows system tray balloon tooltip.
// Because we build with -H windowsgui there is NO console window ever —
// this balloon is the only UI the user sees on first run.
func showInstallNotification() {
	// We use Shell_NotifyIconW to pop a balloon from the system tray area.
	// This is a native Win32 call — no dependencies, no console needed.
	shell32 := syscall.NewLazyDLL("shell32.dll")
	user32  := syscall.NewLazyDLL("user32.dll")
	shellNotifyIcon := shell32.NewProc("Shell_NotifyIconW")
	loadIcon        := user32.NewProc("LoadIconW")

	// NIM_ADD=0, NIM_MODIFY=1, NIM_DELETE=2
	// NIIF_INFO=1 (blue info balloon)
	const (
		NIM_ADD    = 0
		NIM_MODIFY = 1
		NIM_DELETE = 2
		NIF_MESSAGE  = 0x1
		NIF_ICON     = 0x2
		NIF_TIP      = 0x4
		NIF_INFO     = 0x10
		NIIF_INFO    = 0x1
		WM_APP       = 0x8000
	)

	// NOTIFYICONDATA structure (trimmed to what we need — uID=1, minimal fields)
	// We use a fixed-size struct that matches the Win32 layout for unicode.
	type NOTIFYICONDATA struct {
		cbSize           uint32
		hWnd             uintptr
		uID              uint32
		uFlags           uint32
		uCallbackMessage uint32
		hIcon            uintptr
		szTip           [128]uint16
		dwState         uint32
		dwStateMask     uint32
		szInfo          [256]uint16
		uVersion        uint32
		szInfoTitle     [64]uint16
		dwInfoFlags     uint32
	}

	// Load default application icon (IDI_APPLICATION = 32512)
	hIcon, _, _ := loadIcon.Call(0, 32512)

	nid := NOTIFYICONDATA{}
	nid.cbSize = uint32(unsafe.Sizeof(nid))
	nid.uID    = 1
	nid.uFlags = NIF_ICON | NIF_TIP | NIF_INFO
	nid.hIcon  = hIcon

	copyWStr := func(dst []uint16, s string) {
		p, _ := syscall.UTF16FromString(s)
		copy(dst, p)
	}
	copyWStr(nid.szTip[:],       "RealSecCam ObserverStreamer")
	copyWStr(nid.szInfo[:],      "ObserverStreamer installed successfully. Running silently in the background.")
	copyWStr(nid.szInfoTitle[:], "RealSecCam")
	nid.dwInfoFlags = NIIF_INFO

	shellNotifyIcon.Call(NIM_ADD, uintptr(unsafe.Pointer(&nid)))

	// Keep the icon alive long enough for the balloon to display (~5s), then remove
	time.Sleep(6 * time.Second)
	shellNotifyIcon.Call(NIM_DELETE, uintptr(unsafe.Pointer(&nid)))
}

// cleanupOldAgentServices removes legacy "RealSecCam Discovery Agent" Windows services
// and old autorun registry entries left by previous versions.
func cleanupOldAgentServices() {
	oldServices := []string{"RealSecCamDiscoveryAgent", "RealSecCam Discovery Agent", "realseccamdiscoveryagent"}
	for _, svc := range oldServices {
		out, err := hiddenCmd("sc", "query", svc).CombinedOutput()
		if err != nil || len(out) == 0 { continue }
		logf("[Cleanup] Removing old service: %s", svc)
		hiddenCmd("sc", "stop", svc).Run()
		hiddenCmd("sc", "delete", svc).Run()
	}
	// Remove old autorun registry entries from legacy agent names
	advapi32 := syscall.NewLazyDLL("advapi32.dll")
	regOpenKeyEx   := advapi32.NewProc("RegOpenKeyExW")
	regDeleteValue := advapi32.NewProc("RegDeleteValueW")
	regCloseKey2   := advapi32.NewProc("RegCloseKey")
	const HKCU uintptr = 0x80000001
	const KEY_SET_VALUE uintptr = 0x0002
	kp2, _ := syscall.UTF16PtrFromString("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
	var hkey2 uintptr
	r3, _, _ := regOpenKeyEx.Call(HKCU, uintptr(unsafe.Pointer(kp2)), 0, KEY_SET_VALUE, uintptr(unsafe.Pointer(&hkey2)))
	if r3 == 0 {
		defer regCloseKey2.Call(hkey2)
		for _, name := range []string{
			"RealSecCamDiscoveryAgent", "RealSecCam-DiscoveryAgent",
			"RealSecCamObserverStreamer", "RealSecCam-ObserverStreamer",
			"RealSecCamAgent", "RealSecCam-Agent",
		} {
			vn, _ := syscall.UTF16PtrFromString(name)
			regDeleteValue.Call(hkey2, uintptr(unsafe.Pointer(vn)))
		}
	}
}

func platformRegisterAutostart(exePath string) {
	advapi32 := syscall.NewLazyDLL("advapi32.dll")
	regCreateKeyEx := advapi32.NewProc("RegCreateKeyExW")
	regSetValueEx  := advapi32.NewProc("RegSetValueExW")
	regCloseKey    := advapi32.NewProc("RegCloseKey")

	keyPath := "Software\\Microsoft\\Windows\\CurrentVersion\\Run"
	kp, err := syscall.UTF16PtrFromString(keyPath)
	if err != nil { logf("[Autostart] UTF16 keyPath: %v", err); return }

	const HKEY_CURRENT_USER = 0x80000001
	const KEY_SET_VALUE     = 0x0002
	var hkey uintptr
	var disp uint32
	r, _, e := regCreateKeyEx.Call(
		HKEY_CURRENT_USER,
		uintptr(unsafe.Pointer(kp)),
		0, 0, 0,
		KEY_SET_VALUE,
		0,
		uintptr(unsafe.Pointer(&hkey)),
		uintptr(unsafe.Pointer(&disp)),
	)
	if r != 0 { logf("[Autostart] RegCreateKeyEx: %v", fmt.Errorf("%w", e)); return }
	defer regCloseKey.Call(hkey)

	vn, err := syscall.UTF16PtrFromString("RealSecCamObserverStreamer")
	if err != nil { logf("[Autostart] UTF16 valueName: %v", err); return }
	d, err := syscall.UTF16FromString(exePath)
	if err != nil { logf("[Autostart] UTF16 data: %v", err); return }
	dataBytes := (*[1 << 20]byte)(unsafe.Pointer(&d[0]))[: len(d)*2 : len(d)*2]
	r2, _, e2 := regSetValueEx.Call(
		hkey,
		uintptr(unsafe.Pointer(vn)),
		0, 1,
		uintptr(unsafe.Pointer(&dataBytes[0])),
		uintptr(len(dataBytes)),
	)
	if r2 != 0 { logf("[Autostart] RegSetValueEx: %v", fmt.Errorf("%w", e2)); return }
	logf("[Autostart] registry key written")
}
