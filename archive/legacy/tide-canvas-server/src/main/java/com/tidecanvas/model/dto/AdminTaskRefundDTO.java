package com.tidecanvas.model.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 管理员对 AI 任务退还积分 DTO。
 * <p>
 * 用于「看似成功实则生成失败」的任务：管理员按该任务的实际扣分全额退还，自动防重复。
 *
 * @author tidecanvas
 */
@Data
public class AdminTaskRefundDTO {

    @NotNull(message = "任务ID不能为空")
    private Long taskId;

    /** 退款原因（可空），记入积分流水备注 */
    private String reason;
}
