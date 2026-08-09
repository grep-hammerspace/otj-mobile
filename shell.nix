{ pkgs ? import (builtins.fetchTarball {
    url = "https://channels.nixos.org/nixos-25.11/nixexprs.tar.xz";
  }) {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs_22      # RN 0.7x / Expo SDK 53+ want Node >= 20; pin the major
    watchman       # Metro file-watching; avoids the inotify-limit warnings
  ];

  shellHook = ''
    echo ""
    echo "otjMobile dev shell ready"
    echo "  node     $(node --version)"
    echo "  npm      $(npm --version)"
    echo "  watchman $(watchman --version)"
    echo ""
    echo "  npm run start:tailnet          start Metro; scan QR with Expo Go"
    echo "  npx expo start --tunnel same, via relay (if LAN discovery fails)"
    echo ""
  '';
}
