package com.tidecanvas.service.impl;

import com.tidecanvas.common.ResultCode;
import com.tidecanvas.exception.BusinessException;
import com.tidecanvas.model.dto.GridSplitDTO;
import com.tidecanvas.service.ImageGridService;
import com.tidecanvas.service.storage.StorageStrategy;
import com.tidecanvas.util.SafeUrl;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
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

@Slf4j
@Service
@RequiredArgsConstructor
public class ImageGridServiceImpl implements ImageGridService {

    private final StorageStrategy storageStrategy;

    private static final long MAX_SOURCE_BYTES = 50L * 1024 * 1024;
    private static final long MAX_PIXELS = 36_000_000L;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    @Override
    public List<String> split(GridSplitDTO dto) {
        int rows = Math.max(1, dto.getRows());
        int cols = Math.max(1, dto.getCols());
        BufferedImage src = download(dto.getImageUrl());
        int w = src.getWidth();
        int h = src.getHeight();

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
            int x = c * w / cols;
            int y = r * h / rows;
            int cw = (c + 1) * w / cols - x;
            int ch = (r + 1) * h / rows - y;
            byte[] bytes = toPng(src.getSubimage(x, y, cw, ch));
            String key = storageStrategy.uploadBytes(bytes, "grid_" + (idx + 1) + ".png", "image/png", "grid");
            urls.add(storageStrategy.getAccessUrl(key));
        }
        log.info("Grid split completed: rows={}, cols={}, tiles={}, source={}x{}",
                rows, cols, urls.size(), w, h);
        return urls;
    }

    private BufferedImage download(String url) {
        SafeUrl.assertPublicHttp(url);
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(30))
                    .GET()
                    .build();
            HttpResponse<InputStream> resp = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
            if (resp.statusCode() / 100 != 2) {
                throw new BusinessException(ResultCode.BAD_REQUEST, "下载源图失败，HTTP " + resp.statusCode());
            }
            byte[] body;
            try (InputStream in = resp.body(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                long total = 0;
                int n;
                while ((n = in.read(buf)) != -1) {
                    total += n;
                    if (total > MAX_SOURCE_BYTES) {
                        throw new BusinessException(ResultCode.FILE_SIZE_EXCEEDED, "源图过大");
                    }
                    out.write(buf, 0, n);
                }
                body = out.toByteArray();
            }
            BufferedImage img = ImageIO.read(new ByteArrayInputStream(body));
            if (img == null) {
                throw new BusinessException(ResultCode.BAD_REQUEST, "无法解析图片内容(服务端不支持该图片格式)");
            }
            if ((long) img.getWidth() * img.getHeight() > MAX_PIXELS) {
                throw new BusinessException(ResultCode.FILE_SIZE_EXCEEDED, "源图像素过大");
            }
            return img;
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException(ResultCode.BAD_REQUEST, "下载源图失败: " + e.getMessage());
        }
    }

    private byte[] toPng(BufferedImage tile) {
        try {
            BufferedImage copy = new BufferedImage(tile.getWidth(), tile.getHeight(), BufferedImage.TYPE_INT_ARGB);
            copy.getGraphics().drawImage(tile, 0, 0, null);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ImageIO.write(copy, "png", out);
            return out.toByteArray();
        } catch (Exception e) {
            throw new BusinessException(ResultCode.SERVER_ERROR, "图片编码失败");
        }
    }
}
