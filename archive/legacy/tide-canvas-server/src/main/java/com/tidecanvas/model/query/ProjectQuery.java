package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class ProjectQuery extends PageQuery {
    private String keyword;
    private Integer status;
}
