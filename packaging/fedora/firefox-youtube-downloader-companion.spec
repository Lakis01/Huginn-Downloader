Name:           firefox-youtube-downloader-companion
Version:        %{app_version}
Release:        1
Summary:        Local Native Messaging companion for Firefox YouTube Downloader
License:        MIT
BuildArch:      noarch
Requires:       yt-dlp
Requires:       ffmpeg-free
Requires:       python3
Requires:       python3-mutagen
Requires:       python3-pillow
Source0:        firefox-youtube-downloader-%{version}-source.tar.gz

%description
Installs the per-machine Native Messaging host and desktop launchers for the
Firefox YouTube Downloader add-on. Install the signed XPI separately in
Firefox. ReplayGain support is optional.

%prep
%setup -q -n firefox-youtube-downloader-%{version}

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
* Sat Nov 14 2026 Firefox YouTube Downloader contributors - %{version}-1
- Initial system-wide Native Messaging companion package
