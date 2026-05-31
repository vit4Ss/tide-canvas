package com.tidecanvas.service;

import com.tidecanvas.model.dto.RefreshTokenDTO;
import com.tidecanvas.model.dto.UpdatePasswordDTO;
import com.tidecanvas.model.dto.UserLoginDTO;
import com.tidecanvas.model.dto.UserRegisterDTO;
import com.tidecanvas.model.vo.LoginVO;
import com.tidecanvas.model.vo.UserVO;

public interface AuthService {

    UserVO register(UserRegisterDTO dto);

    LoginVO login(UserLoginDTO dto);

    LoginVO refreshToken(RefreshTokenDTO dto);

    UserVO getCurrentUser(Long userId);

    void updatePassword(Long userId, UpdatePasswordDTO dto);
}
