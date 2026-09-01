package main

import "testing"

func TestLinuxPlatformFamilyLabel(t *testing.T) {
	tests := map[string]string{
		"red-hat":       "red-hat",
		"DEBIAN-UBUNTU": "debian-ubuntu",
		"kylin":         "kylin",
		"uos":           "uos",
		"linux":         "",
		"unknown":       "",
	}
	for input, expected := range tests {
		if actual := linuxPlatformFamilyLabel(input); actual != expected {
			t.Fatalf("linuxPlatformFamilyLabel(%q) = %q, expected %q", input, actual, expected)
		}
	}
}
