package com.tidecanvas.service.impl;

import com.tidecanvas.model.dto.GridSplitDTO;
import com.tidecanvas.service.ImageGridService;
import com.tidecanvas.service.storage.StorageStrategy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

/**
 * 图片宫格切分实现：服务端下载源图（规避浏览器画布跨域 taint），按网格裁剪后逐块上传。
 *
 * @author tidecanvas
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ImageGridServiceImpl implements ImageGridService {

    private final StorageStrategy storageStrategy;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();

    @Override
    public List<String> split(GridSplitDTO dto) {
        int rows = Math.max(1, dto.getRows());
        int cols = Math.max(1, dto.getCols());
        BufferedImage src = download(dto.getImageUrl());
        int w = src.getWidth();
        int h = src.getHeight();

        // 确定要切的格子（行优先 0-based 索引）：指定 cells 则只切这些，否则全部
        List<Integer> order;
        if (dto.getCells() != null && !dto.getCells().isEmpty()) {
            order = dto.getCells().stream()
                    .filter(i -> i != null && i >= 0 && i < rows * cols)
                    .distinct()
                    .toList();
        } else {
            order = IntStream.range(0, rows * cols).boxed().toList();
        }

        List<String> urls = new ArrayList<>(order.size());
        for (int idx : order) {
            int r = idx / cols;
            int c = idx % cols;
            // 按整数边界切分，末行/末列吸收余数像素，避免漏边或越界
            int x = c * w / cols;
            int y = r * h / rows;
            int cw = (c + 1) * w / cols - x;
            int ch = (r + 1) * h / rows - y;
            byte[] bytes = toPng(src.getSubimage(x, y, cw, ch));
            String key = storageStrategy.uploadBytes(
                    bytes, "grid_" + (idx + 1) + ".png", "image/png", "grid");
            urls.add(storageStrategy.getAccessUrl(key));
        }
        log.info("宫格切分完成: {}x{} 选 {} 块, 源图 {}x{}", rows, cols, urls.size(), w, h);
        return urls;
    }

    /** 下载远程图片为 BufferedImage（服务端发起，无浏览器跨域限制）。 */
    private BufferedImage download(String url) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(30))
                    .GET().build();
            HttpResponse<InputStream> resp = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
            if (resp.statusCode() / 100 != 2) {
                throw new RuntimeException("下载源图失败，HTTP " + resp.statusCode());
            }
            try (InputStream in = resp.body()) {
                BufferedImage img = ImageIO.read(in);
                if (img == null) {
                    throw new RuntimeException("无法解析图片内容（不支持的格式或文件损坏）");
                }
                return img;
            }
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("下载源图失败: " + e.getMessage(), e);
        }
    }

    /** 将裁剪块编码为 PNG 字节。getSubimage 与源图共享栅格，先复制为独立图再编码。 */
    private byte[] toPng(BufferedImage tile) {
        try {
            BufferedImage copy = new BufferedImage(tile.getWidth(), tile.getHeight(), BufferedImage.TYPE_INT_ARGB);
            copy.getGraphics().drawImage(tile, 0, 0, null);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ImageIO.write(copy, "png", out);
            return out.toByteArray();
        } catch (Exception e) {
            throw new RuntimeException("图片编码失败", e);
        }
    }
}
