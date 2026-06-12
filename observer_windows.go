//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"syscall"
	"unsafe"
)

// hiddenCmdPlatform hides child process console windows (arp, netsh, ffmpeg probe).
// Built with -H windowsgui so the main process itself never has a console window.
func hiddenCmdPlatform(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}

// setConsoleTitle is a no-op on Windows GUI subsystem builds.
func setConsoleTitle(_ string) {}

// acquireSingleInstanceMutex creates a named Windows mutex so only ONE
// ObserverStreamer process (any version) can run at a time.
// Returns true if this process won the mutex (should continue running).
// Returns false if another instance already holds it — caller should kill
// the old instance and retry, or exit.
//
// The mutex name is intentionally version-agnostic so ObserverStreamer1.2.5
// and ObserverStreamer1.3.1 cannot both hold it simultaneously.
func acquireSingleInstanceMutex() (bool, uintptr) {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	createMutex := kernel32.NewProc("CreateMutexW")
	getLastError := kernel32.NewProc("GetLastError")

	name, _ := syscall.UTF16PtrFromString("Global\\RealSecCam.ObserverStreamer")
	handle, _, _ := createMutex.Call(0, 1, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		logf("[SingleInstance] CreateMutex failed")
		return false, 0
	}
	// Check GetLastError directly — avoids unsafe type assertion on nil errno
	const ERROR_ALREADY_EXISTS = 183
	lastErr, _, _ := getLastError.Call()
	if lastErr == ERROR_ALREADY_EXISTS {
		logf("[SingleInstance] Another ObserverStreamer is holding the mutex — killing it")
		return false, handle
	}
	logf("[SingleInstance] Acquired single-instance mutex")
	return true, handle
}

// showInstallNotification shows a MessageBox modal dialog the user must click OK to dismiss.
// This is reliable on all Windows versions including Windows 11 (unlike tray balloons which
// are suppressed by Focus Assist / notification settings).
func showInstallNotification() {
	user32 := syscall.NewLazyDLL("user32.dll")
	messageBox := user32.NewProc("MessageBoxW")

	installPath := installDir()
	title, _ := syscall.UTF16PtrFromString("RealSecCam ObserverStreamer v" + Version)
	text, _   := syscall.UTF16PtrFromString("ObserverStreamer v" + Version + " installed successfully!\n\nInstalled to:\n" + installPath + "\n\nRunning silently in the background.\nLogs, FFmpeg, and diagnostics are stored in the install folder.\nAuto-starts on every login.\n\nClick OK to continue.")

	// MB_OK | MB_ICONINFORMATION | MB_SYSTEMMODAL = 0x00000040 | 0x00000040 | 0x00001000
	const MB_OK             = 0x00000000
	const MB_ICONINFORMATION = 0x00000040
	messageBox.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), MB_OK|MB_ICONINFORMATION)
}

// killStaleObserversWindows uses OpenProcess+TerminateProcess directly via syscall.
// This is guaranteed to work — it bypasses taskkill entirely, which can fail silently.
func killStaleObserversWindows(myPID int) {
	myExe := strings.ToLower(filepath.Base(os.Args[0]))
	legacyPrefixes := []string{
		"observerstreamer",
		"realseccam-observer",
		"realseccam-discovery-agent",
		"realseccam-agent",
		"realseccamagent",
		"discovery-agent",
	}

	kernel32        := syscall.NewLazyDLL("kernel32.dll")
	openProcess      := kernel32.NewProc("OpenProcess")
	terminateProcess := kernel32.NewProc("TerminateProcess")
	closeHandle      := kernel32.NewProc("CloseHandle")
	const PROCESS_TERMINATE uintptr = 0x0001

	terminateByPID := func(pid int) {
		handle, _, _ := openProcess.Call(PROCESS_TERMINATE, 0, uintptr(pid))
		if handle == 0 { return }
		defer closeHandle.Call(handle)
		r, _, _ := terminateProcess.Call(handle, 1)
		logf("[Cleanup] TerminateProcess PID=%d result=%d", pid, r)
	}

	// Returns true if any matching process was found (still need to kill)
	killPass := func() bool {
		out, err := hiddenCmd("tasklist", "/FO", "CSV", "/NH").Output()
		if err != nil { return false }
		found := false
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if line == "" { continue }
			fields := strings.Split(line, ",")
			if len(fields) < 2 { continue }
			exeName := strings.ToLower(strings.Trim(strings.TrimSpace(fields[0]), "\""))
			pidStr  := strings.Trim(strings.TrimSpace(fields[1]), "\"")
			pid, err := strconv.Atoi(pidStr)
			if err != nil || pid == myPID || pid == 0 { continue }
			if exeName == myExe { continue }
			for _, prefix := range legacyPrefixes {
				if strings.HasPrefix(exeName, prefix) {
					logf("[Cleanup] Terminating stale observer PID=%d name=%s", pid, exeName)
					terminateByPID(pid)
					// Also taskkill as belt-and-suspenders
					hiddenCmd("taskkill", "/F", "/PID", pidStr).Run()
					found = true
					break
				}
			}
		}
		return found
	}

	// Kill pass, then poll until confirmed dead (up to 5 seconds)
	killPass()
	for i := 0; i < 10; i++ {
		time.Sleep(500 * time.Millisecond)
		if !killPass() {
			logf("[Cleanup] All stale observers terminated after %dms", (i+1)*500)
			return
		}
	}
	logf("[Cleanup] Warning: some stale observers may still be running after 5s")
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
