package com.tidecanvas.config;

import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Jackson 配置 — 将 Long/long 序列化为 String，避免 JavaScript Number 精度丢失
 * （雪花算法生成的 ID 长度 19 位，超过 JS Number.MAX_SAFE_INTEGER 16 位）
 */
@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer jacksonCustomizer() {
        return builder -> {
            SimpleModule longToStringModule = new SimpleModule();
            longToStringModule.addSerializer(Long.class, ToStringSerializer.instance);
            longToStringModule.addSerializer(Long.TYPE, ToStringSerializer.instance);
            builder.modulesToInstall(longToStringModule);
        };
    }
}
