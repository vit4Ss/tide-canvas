package com.tidecanvas.model.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.List;

/**
 * 图片宫格切分请求：将 {@code imageUrl} 指向的图片均匀切成 rows×cols 块。
 *
 * @author tidecanvas
 */
@Data
public class GridSplitDTO {

    @NotBlank(message = "图片地址不能为空")
    private String imageUrl;

    @Min(value = 1, message = "行数至少为 1")
    @Max(value = 10, message = "行数最多为 10")
    private int rows = 1;

    @Min(value = 1, message = "列数至少为 1")
    @Max(value = 10, message = "列数最多为 10")
    private int cols = 1;

    /** 仅切分这些格子（行优先 0-based 索引）；为空则切分全部 */
    private List<Integer> cells;
}
