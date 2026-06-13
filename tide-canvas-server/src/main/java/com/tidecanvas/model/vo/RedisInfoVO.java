package com.tidecanvas.model.vo;

import lombok.Data;

/**
 * Redis 监控信息。
 *
 * @author tidecanvas
 */
@Data
public class RedisInfoVO {
    private boolean connected;
    /** Key 数量（dbSize） */
    private long keyCount;
    /** 命中率 % */
    private double hitRate;
    private String version;
    private long uptimeSeconds;
    private String usedMemoryHuman;
}
