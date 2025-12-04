export const CONFIG = {
    // 这里也可以放一些阈值配置
    SYNC_THRESHOLD_SOFT: 0.5, // 超过0.5秒开始柔性追赶
    SYNC_THRESHOLD_HARD: 3.0, // 超过3秒直接跳转
    PLAYBACK_RATE_FAST: 1.05, // 追赶倍速
    PLAYBACK_RATE_SLOW: 0.95, // 等待倍速
};