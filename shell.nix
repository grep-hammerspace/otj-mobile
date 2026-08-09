{ pkgs ? import (builtins.fetchTarball {
    url = "https://channels.nixos.org/nixos-25.11/nixexprs.tar.xz";
  }) {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs_22      # RN 0.7x / Expo SDK 53+ want Node >= 20; pin the major
    watchman       # Metro file-watching; avoids the inotify-limit warnings
  ];

  shellHook = ''
    # Metro caches its module map. A change that both adds and removes files — a merge
    # that deletes lib/auth.ts and adds auth.tsx, say — can leave that cache stale enough
    # that expo-router's require.context over src/app resolves to *no routes at all*,
    # while the phone keeps showing the last bundle it loaded. `--clear` is the fix, and
    # a plain restart is not: it reuses the same poisoned cache.
    #
    # Delegates to the npm script rather than calling expo directly, so the tailnet
    # hostname and port stay defined in one place (package.json).
    start-clean() { npm run start:tailnet -- --clear "$@"; }

    echo ""
    echo "otjMobile dev shell ready"
    echo "  node     $(node --version)"
    echo "  npm      $(npm --version)"
    echo "  watchman $(watchman --version)"
    echo ""
    echo "  npm run start:tailnet   start Metro; scan QR with Expo Go"
    echo "  start-clean             same, but wipes Metro's cache first"
    echo "                          (use after a merge, or if the app looks stale)"
    echo "  npx expo start --tunnel via relay, if LAN discovery fails"
    echo ""
  '';
}
