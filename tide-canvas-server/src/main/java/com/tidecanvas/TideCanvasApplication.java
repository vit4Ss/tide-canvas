package com.tidecanvas;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@MapperScan("com.tidecanvas.mapper")
@EnableAsync
@EnableScheduling
public class TideCanvasApplication {

    public static void main(String[] args) {
        SpringApplication.run(TideCanvasApplication.class, args);
    }
}
