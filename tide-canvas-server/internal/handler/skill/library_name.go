package skill

import (
	"strings"
	"unicode"
)

// Keep the installed name recognizable from the public title while respecting
// the same Unicode name rules as skillformat and filesystem directory limits.
func libraryInstallName(title, originalName string) string {
	normalize := func(value string) string {
		runes := make([]rune, 0, 64)
		for _, r := range strings.ToLower(strings.TrimSpace(value)) {
			if unicode.IsLetter(r) && !unicode.IsUpper(r) && !unicode.IsTitle(r) || unicode.IsDigit(r) {
				runes = append(runes, r)
			} else if len(runes) > 0 && runes[len(runes)-1] != '-' {
				runes = append(runes, '-')
			}
			if len(runes) == 64 {
				break
			}
		}
		return strings.TrimRight(string(runes), "-")
	}
	name := normalize(title)
	if name == "" {
		name = normalize(originalName)
	}
	if name == "" {
		name = "skill"
	}
	// These are valid Skill names but cannot be directory names on Windows.
	switch name {
	case "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9":
		name += "-skill"
	}
	return name
}
