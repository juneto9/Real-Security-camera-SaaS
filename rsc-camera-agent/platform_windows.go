//go:build windows

package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"syscall"
	"unsafe"
)

func hideWindow() {
	getConsoleWindow := syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow")
	showWindow := syscall.NewLazyDLL("user32.dll").NewProc("ShowWindow")
	hwnd, _, _ := getConsoleWindow.Call()
	if hwnd != 0 {
		showWindow.Call(hwnd, 0) // SW_HIDE = 0
	}
}

func showError(msg string) {
	msgBox := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	caption, _ := syscall.UTF16PtrFromString("RSC Camera Agent")
	text, _ := syscall.UTF16PtrFromString(msg)
	msgBox.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(caption)), 0x10) // MB_ICONERROR
}

func showInfo(msg string) {
	msgBox := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	caption, _ := syscall.UTF16PtrFromString("RSC Camera Agent")
	text, _ := syscall.UTF16PtrFromString(msg)
	msgBox.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(caption)), 0x40) // MB_ICONINFORMATION
}

func promptForCode(prompt string) string {
	fmt.Print(prompt + " ")
	reader := bufio.NewReader(os.Stdin)
	code, _ := reader.ReadString('\n')
	return strings.TrimSpace(code)
}
