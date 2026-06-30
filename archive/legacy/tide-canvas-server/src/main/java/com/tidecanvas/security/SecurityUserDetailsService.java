package com.tidecanvas.security;

import com.tidecanvas.mapper.SysUserMapper;
import com.tidecanvas.model.entity.SysUserDO;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class SecurityUserDetailsService implements UserDetailsService {

    private final SysUserMapper userMapper;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        SysUserDO user = userMapper.selectByAccount(username);
        if (user == null) {
            throw new UsernameNotFoundException("账号不存在: " + username);
        }
        return new SecurityUserDetails(user);
    }

    public UserDetails loadUserById(Long userId) {
        SysUserDO user = userMapper.selectById(userId);
        if (user == null) {
            return null;
        }
        return new SecurityUserDetails(user);
    }
}
