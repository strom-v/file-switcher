# PyInstaller-спека для standalone-бинарника mitmdump с нашим addon.py.
# Запуск: pyinstaller scripts/mitmdump.spec --distpath resources/bin/mac --workpath build --noconfirm
import mitmproxy
import mitmproxy_rs
import os

mitmproxy_hooks_dir = os.path.join(os.path.dirname(mitmproxy.__file__), 'utils', 'pyinstaller')
mitmproxy_rs_hooks_dir = os.path.join(os.path.dirname(mitmproxy_rs.__file__), '_pyinstaller')

a = Analysis(
    [os.path.join(os.path.dirname(os.path.abspath(SPEC)), 'mitmdump_entry.py')],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=['mitmproxy.addons', 'mitmproxy.tools.dump'],
    hookspath=[mitmproxy_hooks_dir, mitmproxy_rs_hooks_dir],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='mitmdump',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
