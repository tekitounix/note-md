{
  description = "note-md VS Code extension dev shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: import nixpkgs { inherit system; };
      tools =
        pkgs:
        [
          pkgs.bash
          pkgs.coreutils
          pkgs.git
          pkgs.jq
          pkgs.nodejs_20
          pkgs.ripgrep
          pkgs.shellcheck
        ];
      appFor =
        pkgs: name: body:
        {
          type = "app";
          meta.description = "Run ${name} for note-md";
          program = "${
            pkgs.writeShellApplication {
              name = name;
              runtimeInputs = tools pkgs;
              text = ''
                repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
                cd "$repo_root"
                ${body}
              '';
            }
          }/bin/${name}";
        };
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            packages = tools pkgs;
          };
        }
      );

      apps = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          check = appFor pkgs "note-md-check" ''
            exec ./scripts/check.sh
          '';
          lint = appFor pkgs "note-md-lint" ''
            exec npm run lint
          '';
          typecheck = appFor pkgs "note-md-typecheck" ''
            exec npm run typecheck
          '';
          test = appFor pkgs "note-md-test" ''
            exec npm test
          '';
          package = appFor pkgs "note-md-package" ''
            exec npm run package
          '';
          default = self.apps.${system}.check;
        }
      );
    };
}
