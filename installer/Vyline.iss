#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#ifndef SourceDir
  #define SourceDir "..\\dist\\windows\\Vyline"
#endif
#ifndef OutputDir
  #define OutputDir "..\\dist\\windows"
#endif
[Setup]
AppId={{9B8C7F0E-4E4D-4E7A-9C9F-6D6E5E8C8A21}
AppName=Vyline
AppVersion={#AppVersion}
AppPublisher=nezumi0627
AppPublisherURL=https://github.com/nezumi0627/Vyline
DefaultDirName={localappdata}\Programs\Vyline
DefaultGroupName=Vyline
OutputDir={#OutputDir}
OutputBaseFilename=VylineSetup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
Uninstallable=yes
[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
[Files]
Source: "{#SourceDir}\Vyline.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\VylineBackend.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\openapi.yaml"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\web\*"; DestDir: "{app}\web"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autoprograms}\Vyline"; Filename: "{app}\Vyline.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Vyline"; Filename: "{app}\Vyline.exe"; WorkingDir: "{app}"
[Run]
Filename: "{app}\Vyline.exe"; Description: "Vylineを起動する"; Flags: nowait postinstall skipifsilent
[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM Vyline.exe"; Flags: runhidden
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM VylineBackend.exe"; Flags: runhidden
