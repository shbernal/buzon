# Rendered by record.sh, which fills in ADDRESS and OUTPUT.
Output "{{OUTPUT}}"

Set Shell bash
Set FontFamily "JetBrainsMono Nerd Font"
Set FontSize 22
Set LineHeight 1.25
Set Width 1200
Set Height 540
Set Padding 32
Set Theme { "name": "Tokyo Night", "background": "#1a1b26", "foreground": "#c0caf5", "cursor": "#c0caf5", "selection": "#33467c", "black": "#15161e", "red": "#f7768e", "green": "#9ece6a", "yellow": "#e0af68", "blue": "#7aa2f7", "magenta": "#bb9af7", "cyan": "#7dcfff", "white": "#a9b1d6", "brightBlack": "#414868", "brightRed": "#f7768e", "brightGreen": "#9ece6a", "brightYellow": "#e0af68", "brightBlue": "#7aa2f7", "brightMagenta": "#bb9af7", "brightCyan": "#7dcfff", "brightWhite": "#c0caf5" }
Set TypingSpeed 45ms
Set CursorBlink false

Hide
Type "exec bash --noprofile --rcfile ./demo.bashrc" Enter
Sleep 500ms
Type "clear" Enter
Sleep 300ms
Show

Sleep 600ms
Type "buzon new ste" Sleep 400ms Enter
Sleep 1.8s
Type "# sign up with it, then wait for the code" Sleep 300ms Enter
Sleep 800ms
Type "buzon wait {{ADDRESS}} --code" Sleep 400ms Enter
Wait+Screen@15s /(?m)^\d{6} *$/
Sleep 2s
Type "buzon delete {{ADDRESS}}" Sleep 400ms Enter
Sleep 1.5s
Type "buzon list" Sleep 400ms Enter
Sleep 4s
