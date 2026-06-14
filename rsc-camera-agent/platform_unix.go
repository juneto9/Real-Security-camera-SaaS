//go:build !windows

package main

import (
"fmt"
"os"
)

func hideWindow() {}
func showError(msg string) { fmt.Fprintf(os.Stderr, "ERROR: %s\n", msg) }
func showInfo(msg string) { fmt.Println(msg) }
func promptForCode(prompt string) string {
fmt.Println(prompt)
fmt.Print("Code: ")
var code string
fmt.Scanln(&code)
return code
}
