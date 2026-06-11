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

// registerAutostartWindows writes the Run registry key via advapi32.dll — no reg.exe, no PowerShell.
func registerAutostartWindows(exePath string) {
	keyPath := "Software\\Microsoft\\Windows\\CurrentVersion\\Run"
	kp, err := syscall.UTF16PtrFromString(keyPath)
	if err != nil { logf("[Autostart] UTF16 keyPath: %v", err); return }
	var hkey syscall.Handle
	var disp uint32
	if err := syscall.RegCreateKeyEx(
		syscall.HKEY_CURRENT_USER, kp, 0, nil, 0,
		syscall.KEY_SET_VALUE, nil, &hkey, &disp,
	); err != nil { logf("[Autostart] RegCreateKeyEx: %v", err); return }
	defer syscall.RegCloseKey(hkey)
	vn, err := syscall.UTF16PtrFromString("RealSecCamObserver")
	if err != nil { logf("[Autostart] UTF16 valueName: %v", err); return }
	d, err := syscall.UTF16FromString(exePath)
	if err != nil { logf("[Autostart] UTF16 data: %v", err); return }
	dataBytes := (*[1 << 20]byte)(unsafe.Pointer(&d[0]))[: len(d)*2 : len(d)*2]
	regSetValueEx := syscall.NewLazyDLL("advapi32.dll").NewProc("RegSetValueExW")
	r, _, e := regSetValueEx.Call(
		uintptr(hkey),
		uintptr(unsafe.Pointer(vn)),
		0,
		1,
		uintptr(unsafe.Pointer(&dataBytes[0])),
		uintptr(len(dataBytes)),
	)
	if r != 0 { logf("[Autostart] RegSetValueEx: %v", fmt.Errorf("%w", e)); return }
	logf("[Autostart] registry key written")
}