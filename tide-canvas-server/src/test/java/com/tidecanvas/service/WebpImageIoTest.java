package com.tidecanvas.service;

import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * WebP 解码能力守护:宫格切分依赖 TwelveMonkeys imageio-webp 读取
 * Midjourney/中转站输出的 WebP 源图,该依赖被移除时此测试失败。
 */
class WebpImageIoTest {

    @Test
    void webpImageReaderRegistered() {
        assertTrue(ImageIO.getImageReadersByMIMEType("image/webp").hasNext(),
                "缺少 WebP ImageIO 插件(com.twelvemonkeys.imageio:imageio-webp)");
        assertTrue(ImageIO.getImageReadersByFormatName("webp").hasNext());
    }
}
