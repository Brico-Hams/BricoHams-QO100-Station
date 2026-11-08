# 0016. USB access rules and kernel module blacklist in the .deb

- **Status:** Accepted
- **Date:** 2026-11-08

## Context
The Linux install tutorials (GQRX/RTL-SDR on Ubuntu, `rtl_test`, superkuh) agree on two recurring problems: the kernel DVB driver (`dvb_usb_rtl28xxu`) grabs the RTL-SDR, and USB devices are not accessible to a non-root service.

## Decision
- `packaging/linux/99-bricohams-sdr.rules` gives group `bricohams` (mode 0660, `uaccess`) access to RTL-SDR (0bda:2838, 0bda:2832), Airspy, Airspy HF+, SDRplay, HackRF and ADALM-Pluto. IDs for SDRplay and others are marked "verify with `lsusb`".
- `packaging/linux/blacklist-bricohams-rtl.conf` blacklists `dvb_usb_rtl28xxu`, `rtl2832` and `rtl2830`.
- `build-deb.sh` installs them to `/lib/udev/rules.d/` and `/etc/modprobe.d/` (the latter as a conffile). `postinst` adds the service user to `plugdev` and `dialout` when they exist and reloads udev; `postrm` reloads udev and, on purge, removes the blacklist.
- The blacklist is global to the host. It is documented, and users who need DVB-T on the same machine can delete the file.

## Alternatives considered
- **Running the service as root**: rejected.
- **Documentation only**: error-prone; the failure ("usb_claim_interface error -6") is confusing.

## Consequences
- Users must replug the dongle or reboot once after installation.
