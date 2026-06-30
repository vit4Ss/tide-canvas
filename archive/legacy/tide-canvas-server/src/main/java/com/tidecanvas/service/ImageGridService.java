package com.tidecanvas.service;

import com.tidecanvas.model.dto.GridSplitDTO;

import java.util.List;

/**
 * 图片宫格切分服务。
 *
 * @author tidecanvas
 */
public interface ImageGridService {

    /**
     * 将图片按 rows×cols 均匀切分，逐块上传存储，返回行优先顺序的公网 URL 列表。
     */
    List<String> split(GridSplitDTO dto);
}
