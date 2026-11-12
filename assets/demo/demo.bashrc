# Shell for the recording: buzon reads config, registry and credentials from ./state only,
# and its passwords from the environment, never from the keyring.
export XDG_CONFIG_HOME="$PWD/state/config" XDG_DATA_HOME="$PWD/state/data"
export XDG_STATE_HOME="$PWD/state/state" XDG_CACHE_HOME="$PWD/state/cache"
export BUZON_SITE_PASSWORD=demo BUZON_ADMIN_PASSWORD=demo
export PATH="$BUZON_DEMO_BIN:$PATH"
unset PROMPT_COMMAND
HISTFILE=/dev/null
PS1='\[\e[38;2;122;162;247m\]❯\[\e[0m\] '
bind 'set show-mode-in-prompt off'
bind 'set editing-mode emacs'
