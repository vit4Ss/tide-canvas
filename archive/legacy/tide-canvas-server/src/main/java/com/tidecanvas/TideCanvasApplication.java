package com.tidecanvas;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.util.TimeZone;

@SpringBootApplication
@MapperScan("com.tidecanvas.mapper")
@EnableAsync
@EnableScheduling
public class TideCanvasApplication {

    public static void main(String[] args) {
        // 强制 JVM 默认时区为上海(UTC+8)，确保 LocalDateTime.now()/new Date() 与入库一致。
        // 容器/服务器 OS 默认常为 UTC，否则所有时间会比上海慢 8 小时（LocalDateTime 无时区，
        // Jackson 的 time-zone 也不会对其做转换，必须从产生源头修正）。须在 run() 之前设置。
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
        SpringApplication.run(TideCanvasApplication.class, args);
    }
}
