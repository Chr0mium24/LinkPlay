/**
 * NTP 时间同步模块
 * 负责计算：ServerTime = LocalTime + offset
 */
export class TimeSyncer {
    constructor(socket) {
        this.socket = socket;
        this.offset = 0;
        this.isReady = false;
        
        this.socket.on('time_sync_response', (data) => this.handleResponse(data));
    }

    async startSync() {
        console.log("Starting NTP Sync...");
        // 连续发送5次Ping取平均值（简化起见，这里只发，由handleResponse更新）
        for(let i=0; i<5; i++) {
            this.socket.emit('time_sync', Date.now()); // 发送 Local T1
            await new Promise(r => setTimeout(r, 200)); 
        }
    }

    handleResponse(data) {
        const t1 = data.client_send_time;
        const t2 = Date.now();
        const serverReceiveTime = data.server_receive_time;
        
        // RTT = T2 - T1
        const rtt = t2 - t1;
        // Offset = T_server - (T1 + RTT/2) = T_server - (T2 - RTT/2)
        // 计算出的 offset 即：LocalTime + offset = ServerTime
        const offset = serverReceiveTime - (t2 - rtt / 2);
        
        // 简单覆盖更新 (生产环境可做加权平均)
        this.offset = offset;
        this.isReady = true;
        
        document.getElementById('syncStatus').innerText = `已同步 (延迟: ${rtt}ms)`;
    }

    getServerTime() {
        return Date.now() + this.offset;
    }
}