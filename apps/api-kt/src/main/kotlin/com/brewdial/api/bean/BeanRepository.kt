package com.brewdial.api.bean

import org.springframework.data.jpa.repository.JpaRepository

interface BeanRepository : JpaRepository<Bean, String>
