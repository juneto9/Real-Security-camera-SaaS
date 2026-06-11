//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"syscall"
	"unsafe"
)

// hiddenCmdPlatform sets CREATE_NO_WINDOW on Windows so no CMD flash occurs.
func hiddenCmdPlatform(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
}

// showInstallNotification shows a native MessageBox via user32.dll — no VBScript, no wscript.
func showInstallNotification() {
	user32 := syscall.NewLazyDLL("user32.dll")
	msgBox := user32.NewProc("MessageBoxW")
	title, _ := syscall.UTF16PtrFromString("RealSecCam Observer")
	msg, _ := syscall.UTF16PtrFromString("RealSecCam Observer v" + Version + " is now running.\n\nCameras on your network will appear in the dashboard automatically.")
	msgBox.Call(0, uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(title)), 0x40)
}

// platformRegisterAutostart writes the Run registry key via advapi32.dll — no reg.exe, no PowerShell.
// Uses only LazyDLL proc calls (no syscall.RegCreateKeyEx which is not in Go stdlib).
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

	vn, err := syscall.UTF16PtrFromString("RealSecCamObserver")
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