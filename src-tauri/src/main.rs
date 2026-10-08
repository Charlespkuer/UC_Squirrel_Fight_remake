// 松鼠大战 怀旧复刻版 —— 桌面可执行入口
//
// 真正的逻辑在 lib.rs 里（同一个 crate 还要产出 lib，给 Android/iOS 用）。
// 桌面端：双击 exe → run() → 找到游戏目录 → 起内置迷你服务器 → 开原生窗口。
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    ssdz_classic_lib::run();
}
