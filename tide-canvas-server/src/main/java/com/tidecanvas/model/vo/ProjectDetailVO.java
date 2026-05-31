package com.tidecanvas.model.vo;

import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class ProjectDetailVO extends ProjectVO {
    private String canvasData;
    private String shareToken;
}
