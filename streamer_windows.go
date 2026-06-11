//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"syscall"
	"unsafe"
)

func hiddenCmdPlatform(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
}

func showNotification() {
	user32 := syscall.NewLazyDLL("user32.dll")
	msgBox := user32.NewProc("MessageBoxW")
	title, _ := syscall.UTF16PtrFromString("RealSecCam Streamer")
	msg, _ := syscall.UTF16PtrFromString("RealSecCam Streamer v" + Version + " is now running.\n\nYour webcam is streaming to the cloud relay.\nOpen the dashboard to view Live Feed.")
	msgBox.Call(0, uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(title)), 0x40)
}

func platformRegisterAutostart(exePath string) {
	advapi32 := syscall.NewLazyDLL("advapi32.dll")
	regCreateKeyEx := advapi32.NewProc("RegCreateKeyExW")
	regSetValueEx  := advapi32.NewProc("RegSetValueExW")
	regCloseKey    := advapi32.NewProc("RegCloseKey")
	keyPath := "Software\\Microsoft\\Windows\\CurrentVersion\\Run"
	kp, err := syscall.UTF16PtrFromString(keyPath)
	if err != nil { return }
	const HKEY_CURRENT_USER = 0x80000001
	const KEY_SET_VALUE     = 0x0002
	var hkey uintptr
	var disp uint32
	r, _, _ := regCreateKeyEx.Call(HKEY_CURRENT_USER, uintptr(unsafe.Pointer(kp)), 0, 0, 0, KEY_SET_VALUE, 0, uintptr(unsafe.Pointer(&hkey)), uintptr(unsafe.Pointer(&disp)))
	if r != 0 { return }
	defer regCloseKey.Call(hkey)
	vn, err := syscall.UTF16PtrFromString("RealSecCamStreamer")
	if err != nil { return }
	d, err := syscall.UTF16FromString(exePath)
	if err != nil { return }
	dataBytes := (*[1 << 20]byte)(unsafe.Pointer(&d[0]))[: len(d)*2 : len(d)*2]
	regSetValueEx.Call(hkey, uintptr(unsafe.Pointer(vn)), 0, 1, uintptr(unsafe.Pointer(&dataBytes[0])), uintptr(len(dataBytes)))
	logf("[Autostart] Registry key written for RealSecCamStreamer")
	_ = fmt.Sprintf("registered")
}