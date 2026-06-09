; RealSecCam Discovery Agent - Enterprise Windows Installer
; Built with Inno Setup 6 - produces a single signed .exe

#define AppName "RealSecCam Discovery Agent"
#define AppVersion "3.0.0"
#define AppPublisher "RealSecCam"
#define AppURL "https://realseccam.com"
#define AppExeName "RealSecCam-Discovery-Agent.exe"
#define InstallerName "RealSecCam-Install"

[Setup]
AppId={{B4E2A1C3-9F8D-4E5B-A2C1-D3E4F5A6B7C8}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\RealSecCam
DefaultGroupName=RealSecCam
OutputDir=dist
OutputBaseFilename={#InstallerName}
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
WizardResizable=no
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#AppExeName}
SetupIconFile=assets\icon.ico
WizardImageFile=assets\wizard.bmp
WizardSmallImageFile=assets\wizard-small.bmp

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "bin\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#AppExeName}"; Parameters: "--uninstall"; Flags: nowait

[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  // Check if Docker Desktop is installed
  if not RegKeyExists(HKLM, 'SOFTWARE\Docker Inc.\Docker Desktop') then
  begin
    if MsgBox('Docker Desktop is required to run the RealSecCam Discovery Agent.' + #13#10 + #13#10 +
      'Click OK to download and install Docker Desktop automatically, or Cancel to install it manually later.',
      mbConfirmation, MB_OKCANCEL) = IDOK then
    begin
      ShellExec('open', 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe', '', '', SW_SHOW, ewNoWait, ResultCode);
      MsgBox('Docker Desktop is downloading.' + #13#10 + 'Once installed, please run this installer again.', mbInformation, MB_OK);
      Result := False;
    end;
  end;
end;
