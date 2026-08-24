package buildinfo

import "runtime"

var (
	Version         = "0.1.0-dev"
	Commit          = "unknown"
	BuildTime       = "unknown"
	SourceDateEpoch = "0"
)

type Info struct {
	Name            string `json:"name"`
	Version         string `json:"version"`
	Commit          string `json:"commit"`
	BuildTime       string `json:"buildTime"`
	SourceDateEpoch string `json:"sourceDateEpoch"`
	Runtime         string `json:"runtime"`
	GoVersion       string `json:"goVersion"`
	GOOS            string `json:"goos"`
	GOARCH          string `json:"goarch"`
	CGOEnabled      bool   `json:"cgoEnabled"`
	MinimumKernel   string `json:"minimumKernel"`
	LibcRequirement string `json:"libcRequirement"`
}

func Current() Info {
	return Info{
		Name:            "gcac-linux-agent",
		Version:         Version,
		Commit:          Commit,
		BuildTime:       BuildTime,
		SourceDateEpoch: SourceDateEpoch,
		Runtime:         "go",
		GoVersion:       runtime.Version(),
		GOOS:            runtime.GOOS,
		GOARCH:          runtime.GOARCH,
		CGOEnabled:      false,
		MinimumKernel:   "3.2",
		LibcRequirement: "none-static-go",
	}
}
