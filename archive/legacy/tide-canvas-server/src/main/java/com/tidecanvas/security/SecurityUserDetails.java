package com.tidecanvas.security;

import com.tidecanvas.model.entity.SysUserDO;
import lombok.Getter;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;

@Getter
public class SecurityUserDetails implements UserDetails {

    private final Long userId;
    private final String username;
    private final String password;
    private final Integer role;
    private final boolean enabled;
    private final Collection<? extends GrantedAuthority> authorities;

    public SecurityUserDetails(SysUserDO user) {
        this.userId = user.getId();
        this.username = user.getUsername();
        this.password = user.getPassword();
        this.role = user.getRole();
        this.enabled = user.getStatus() == 1;

        List<SimpleGrantedAuthority> auths = new java.util.ArrayList<>();
        auths.add(new SimpleGrantedAuthority(user.getRole() == 9 ? "ROLE_ADMIN" : "ROLE_USER"));
        if (user.getIsAuthor() != null && user.getIsAuthor() == 1) {
            auths.add(new SimpleGrantedAuthority("ROLE_AUTHOR"));
        }
        this.authorities = auths;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return enabled;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }
}
