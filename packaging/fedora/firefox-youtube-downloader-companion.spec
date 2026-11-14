Name:           firefox-youtube-downloader-companion
Version:        %{app_version}
Release:        1
Summary:        Local Native Messaging companion for Huginn Downloader
License:        MIT
BuildArch:      noarch
Requires:       python3
Suggests:       yt-dlp
Suggests:       ffmpeg-free
Suggests:       python3-mutagen
Suggests:       python3-pillow
Suggests:       rsgain
Source0:        huginn-downloader-%{version}-source.tar.gz

%description
Installs the per-machine Native Messaging host and desktop launchers for the
Huginn Downloader add-on. Install the signed XPI separately in
Firefox. ReplayGain support is optional.

%prep
%setup -q -n huginn-downloader-%{version}

%build

%install
rm -rf %{buildroot}
bash packaging/linux/stage-root.sh . %{buildroot} /usr/lib64/mozilla/native-messaging-hosts

%files
%license /usr/share/licenses/firefox-youtube-downloader-companion/LICENSE
%doc /usr/share/doc/firefox-youtube-downloader-companion/README.md
%dir /usr/lib/firefox-youtube-downloader
/usr/lib/firefox-youtube-downloader/*
/usr/lib64/mozilla/native-messaging-hosts/firefox_youtube_downloader.json
/usr/share/applications/*.desktop

%changelog
* Sat Nov 14 2026 Huginn Downloader contributors - %{version}-1
- Initial system-wide Native Messaging companion package
