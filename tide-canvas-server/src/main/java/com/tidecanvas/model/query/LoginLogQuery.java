package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class LoginLogQuery extends PageQuery {
    /** 登录账号关键字(模糊) */
    private String keyword;
    /** 结果(1:成功,0:失败),空为全部 */
    private Integer status;
    private String startTime;
    private String endTime;
}
