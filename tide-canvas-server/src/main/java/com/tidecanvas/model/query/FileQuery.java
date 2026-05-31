package com.tidecanvas.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class FileQuery extends PageQuery {
    private String fileType;
    private String keyword;
}
